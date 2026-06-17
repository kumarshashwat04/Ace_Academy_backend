import { Router } from "express";
import coursesRoutes from "../modules/courses/courses.module";
import levelsRoutes from "../modules/levels/levels.module";
import modulesRoutes from "../modules/modules/modules.module";
import topicsRoutes from "../modules/topics/topics.module";
import resourcesRoutes from "../modules/resources/resources.module";

/**
 * Aggregates every table module's router under /api.
 *
 * To add a new table:
 *   1. Create src/modules/<table>/<table>.module.ts:
 *        export const <table>Repository = new BaseRepository("<table>");
 *        export default createResourceRouter(<table>Repository, "<Name>");
 *   2. Import and mount it below with apiRouter.use("/<table>", ...).
 */
const apiRouter = Router();

apiRouter.use("/courses", coursesRoutes);
apiRouter.use("/levels", levelsRoutes);
apiRouter.use("/modules", modulesRoutes);
apiRouter.use("/topics", topicsRoutes);
apiRouter.use("/resources", resourcesRoutes);

export default apiRouter;
