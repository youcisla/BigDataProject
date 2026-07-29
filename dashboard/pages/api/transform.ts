import type { NextApiRequest, NextApiResponse } from "next";
import { startJob } from "../../lib/jobs";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const today = new Date().toISOString().slice(0, 10);
  const job = startJob(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "-e",
      "HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop",
      "spark-master",
      "spark-submit",
      "--master",
      "spark://spark-master:7077",
      "--deploy-mode",
      "client",
      "/opt/spark/jobs/silver_transform.py",
      "--date",
      today,
    ],
    "transform"
  );
  res.status(202).json({ jobId: job.id, status: job.status, startedAt: job.startedAt });
}
