import { BaseRepository } from "../../core/BaseRepository";
import { createResourceRouter } from "../../core/createResourceRouter";

/**
 * `modules` table.
 */
export const modulesRepository = new BaseRepository("modules");

export default createResourceRouter(modulesRepository, "Module");
