import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getStrategyDefinition } from "../strategies";

export const configsRouter = Router();

const createConfigSchema = z.object({
  strategyId: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()),
});

configsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }

    const strategy = await prisma.strategy.findUnique({
      where: { id: parsed.data.strategyId },
    });
    if (!strategy) {
      throw new HttpError(404, `Strategy ${parsed.data.strategyId} not found`);
    }

    // Params are strategy-specific, so the generic route defers to the
    // strategy's own zod schema. Invalid params never reach the database.
    const definition = getStrategyDefinition(strategy.slug);
    if (!definition) {
      throw new HttpError(500, `No implementation registered for strategy '${strategy.slug}'`);
    }
    const paramsResult = definition.paramsSchema.safeParse(parsed.data.params);
    if (!paramsResult.success) {
      throw new HttpError(
        400,
        paramsResult.error.issues.map((i) => `params.${i.path.join(".")}: ${i.message}`).join("; ")
      );
    }

    const config = await prisma.strategyConfig.create({
      data: {
        strategyId: strategy.id,
        params: JSON.parse(JSON.stringify(paramsResult.data)),
      },
    });
    res.status(201).json(config);
  })
);

configsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid config id");

    const config = await prisma.strategyConfig.findUnique({
      where: { id },
      include: { strategy: { select: { slug: true, name: true } } },
    });
    if (!config) throw new HttpError(404, `Config ${id} not found`);
    res.json(config);
  })
);
