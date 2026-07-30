import type { NextApiRequest, NextApiResponse } from "next";
import { startJob } from "../../lib/jobs";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const job = startJob(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "spark-master",
      "spark-submit",
      "--master",
      "spark://spark-master:7077",
      "--deploy-mode",
      "client",
      "--packages",
      "org.postgresql:postgresql:42.7.3",
      "/opt/spark/jobs/gold_kpis.py",
    ],
    "load"
  );
  res.status(202).json({ jobId: job.id, status: job.status, startedAt: job.startedAt });
}
