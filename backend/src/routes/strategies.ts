import { Router } from "express";
import { asyncHandler, HttpError } from "../lib/errors";
import { prisma } from "../lib/prisma";

export const strategiesRouter = Router();

strategiesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const strategies = await prisma.strategy.findMany({
      orderBy: { id: "asc" },
    });
    res.json(strategies);
  })
);

strategiesRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    // Express 5 types params as string | string[] (arrays only for wildcard
    // routes, which this isn't) — normalize to satisfy the compiler.
    const slug = String(req.params.slug);
    const strategy = await prisma.strategy.findUnique({
      where: { slug },
    });
    if (!strategy) {
      throw new HttpError(404, `Strategy '${slug}' not found`);
    }
    res.json(strategy);
  })
);
