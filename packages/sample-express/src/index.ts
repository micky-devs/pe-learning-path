import express, { type Request, type Response } from "express";

const SERVICE_NAME = "sample-express";
const PORT = Number(process.env.PORT ?? 3000);

const app = express();

app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", service: SERVICE_NAME });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] listening on port ${PORT}`);
});
