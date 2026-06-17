import { BaseRepository } from "../../core/BaseRepository";
import { createResourceRouter } from "../../core/createResourceRouter";

/**
 * `topics` table.
 */
export const topicsRepository = new BaseRepository("topics");

export default createResourceRouter(topicsRepository, "Topic");
