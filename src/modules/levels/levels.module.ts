import { BaseRepository } from "../../core/BaseRepository";
import { createResourceRouter } from "../../core/createResourceRouter";

/**
 * `levels` table (belongs to a course via course_id).
 * Filter by course with: GET /api/levels?course_id=<id>
 */
export const levelsRepository = new BaseRepository("levels");

export default createResourceRouter(levelsRepository, "Level");
