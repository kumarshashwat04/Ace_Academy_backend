import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { checkConnection } from "./db/pool";
import apiRouter from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { asyncHandler } from "./core/asyncHandler";

/**
 * Builds and configures the Express application (without starting it).
 */
export function createApp(): Application {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",").map((o) => o.trim()),
    })
  );
  app.use(express.json());

  // Liveness + DB connectivity check.
  app.get(
    "/health",
    asyncHandler(async (_req: Request, res: Response) => {
      const dbOk = await checkConnection();
      res.status(dbOk ? 200 : 503).json({
        status: dbOk ? "ok" : "degraded",
        db: dbOk ? "connected" : "disconnected",
      });
    })
  );

  app.use("/api", apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
