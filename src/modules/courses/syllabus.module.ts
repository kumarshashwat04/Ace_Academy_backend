import { PoolClient } from "pg";
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler";
import { ApiError } from "../../core/ApiError";
import { query, queryOne } from "../../db/query";
import { withTransaction } from "../../db/transaction";

const router = Router();

type CourseRow = { id: string; name: string; subject: string | null; icon: string | null };
type LevelRow = { id: number; name: string };
type TopicRow = { id: number; level_id: number; title: string };
type ModuleRow = { id: number; topic_id: number; code: string; title: string; description: string };
type ResourceRow = { id: number; module_id: number; label: string; type: string; url: string };

/**
 * Assembles one course's full syllabus tree from the five normalized tables
 * (courses -> levels -> topics -> modules -> resources), ordered by id
 * (insertion order — these tables have no explicit position column).
 * Maps the DB's `subject` column to the API's `sub` field, matching the
 * shape app/syllabus/page.tsx and lib/syllabus-progress.ts already expect.
 */
async function fetchSyllabusTree(id: string) {
  const course = await queryOne<CourseRow>(
    `SELECT id, name, subject, icon FROM courses WHERE id = $1`,
    [id]
  );
  if (!course) return null;

  const levels = await query<LevelRow>(
    `SELECT id, name FROM levels WHERE course_id = $1 ORDER BY id`,
    [id]
  );
  const levelIds = levels.map((l) => l.id);

  const topics = levelIds.length
    ? await query<TopicRow>(
        `SELECT id, level_id, title FROM topics WHERE level_id = ANY($1) ORDER BY id`,
        [levelIds]
      )
    : [];
  const topicIds = topics.map((t) => t.id);

  const modules = topicIds.length
    ? await query<ModuleRow>(
        `SELECT id, topic_id, code, title, description FROM modules WHERE topic_id = ANY($1) ORDER BY id`,
        [topicIds]
      )
    : [];
  const moduleIds = modules.map((m) => m.id);

  const resources = moduleIds.length
    ? await query<ResourceRow>(
        `SELECT id, module_id, label, type, url FROM resources WHERE module_id = ANY($1) ORDER BY id`,
        [moduleIds]
      )
    : [];

  const resourcesByModule = new Map<number, ResourceRow[]>();
  for (const r of resources) {
    const list = resourcesByModule.get(r.module_id) ?? [];
    list.push(r);
    resourcesByModule.set(r.module_id, list);
  }

  const modulesByTopic = new Map<number, ReturnType<typeof toModuleJson>[]>();
  function toModuleJson(m: ModuleRow) {
    return {
      code: m.code,
      title: m.title,
      description: m.description,
      resources: (resourcesByModule.get(m.id) ?? []).map((r) => ({
        label: r.label,
        type: r.type,
        url: r.url,
      })),
    };
  }
  for (const m of modules) {
    const list = modulesByTopic.get(m.topic_id) ?? [];
    list.push(toModuleJson(m));
    modulesByTopic.set(m.topic_id, list);
  }

  const topicsByLevel = new Map<number, { title: string; modules: ReturnType<typeof toModuleJson>[] }[]>();
  for (const t of topics) {
    const list = topicsByLevel.get(t.level_id) ?? [];
    list.push({ title: t.title, modules: modulesByTopic.get(t.id) ?? [] });
    topicsByLevel.set(t.level_id, list);
  }

  return {
    id: course.id,
    name: course.name,
    sub: course.subject,
    icon: course.icon,
    levels: levels.map((l) => ({ name: l.name, topics: topicsByLevel.get(l.id) ?? [] })),
  };
}

export type IncomingResource = { label: string; type: string; url: string };
export type IncomingModule = { code: string; title: string; description?: string; resources?: IncomingResource[] };
export type IncomingTopic = { title: string; modules?: IncomingModule[] };
export type IncomingLevel = { name: string; topics?: IncomingTopic[] };
export type IncomingTree = { name?: string; sub?: string; icon?: string; levels: IncomingLevel[] };

/**
 * Full-tree replace for one course, in a single transaction: upserts the
 * course row, deletes all its levels (cascades to topics/modules/resources),
 * then re-inserts everything submitted. Matches manageprogram's existing
 * always-send-everything save semantics — used by both the PUT endpoint
 * (live admin edits) and the one-time Firestore migration script.
 */
export async function replaceCourseSyllabus(
  client: PoolClient,
  id: string,
  tree: IncomingTree
): Promise<void> {
  await client.query(
    `INSERT INTO courses (id, name, subject, icon)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, subject = EXCLUDED.subject, icon = EXCLUDED.icon, updated_at = now()`,
    [id, tree.name ?? id, tree.sub ?? null, tree.icon ?? null]
  );

  await client.query(`DELETE FROM levels WHERE course_id = $1`, [id]);

  for (const level of tree.levels ?? []) {
    const levelResult = await client.query<{ id: number }>(
      `INSERT INTO levels (course_id, name) VALUES ($1, $2) RETURNING id`,
      [id, level.name]
    );
    const levelId = levelResult.rows[0].id;

    for (const topic of level.topics ?? []) {
      const topicResult = await client.query<{ id: number }>(
        `INSERT INTO topics (level_id, title) VALUES ($1, $2) RETURNING id`,
        [levelId, topic.title]
      );
      const topicId = topicResult.rows[0].id;

      for (const mod of topic.modules ?? []) {
        const moduleResult = await client.query<{ id: number }>(
          `INSERT INTO modules (topic_id, code, title, description) VALUES ($1, $2, $3, $4) RETURNING id`,
          [topicId, mod.code, mod.title, mod.description ?? ""]
        );
        const moduleId = moduleResult.rows[0].id;

        for (const resource of mod.resources ?? []) {
          await client.query(
            `INSERT INTO resources (module_id, label, type, url) VALUES ($1, $2, $3, $4)`,
            [moduleId, resource.label, resource.type, resource.url]
          );
        }
      }
    }
  }
}

router.get(
  "/:id/syllabus",
  asyncHandler(async (req, res) => {
    const tree = await fetchSyllabusTree(req.params.id);
    if (!tree) throw ApiError.notFound(`Course '${req.params.id}' not found`);
    res.json(tree);
  })
);

router.put(
  "/:id/syllabus",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = (req.body ?? {}) as Partial<IncomingTree>;

    if (!Array.isArray(body.levels)) {
      throw ApiError.badRequest("levels[] is required.");
    }

    await withTransaction((client) => replaceCourseSyllabus(client, id, body as IncomingTree));

    res.json({ ok: true, id });
  })
);

export default router;
