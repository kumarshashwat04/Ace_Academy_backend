import { BaseRepository } from "../../core/BaseRepository";
import { createResourceRouter } from "../../core/createResourceRouter";

/**
 * `resources` table.
 */
export const resourcesRepository = new BaseRepository("resources");

export default createResourceRouter(resourcesRepository, "Resource");
