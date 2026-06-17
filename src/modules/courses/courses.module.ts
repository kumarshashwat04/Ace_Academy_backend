import { BaseRepository } from "../../core/BaseRepository";
import { createResourceRouter } from "../../core/createResourceRouter";

/**
 * `courses` table. Columns & primary key are auto-discovered from the catalog.
 * To restrict exposed columns, pass `{ columns: [...] }` to the repository.
 * For custom logic, add a service/controller and define handlers explicitly
 * instead of using createResourceRouter.
 */
export const coursesRepository = new BaseRepository("courses");

export default createResourceRouter(coursesRepository, "Course");
