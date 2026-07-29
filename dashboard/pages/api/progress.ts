import type { NextApiRequest, NextApiResponse } from "next";
import { getJob, listJobs } from "../../lib/jobs";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const jobId = typeof req.query.jobId === "string" ? req.query.jobId : null;

  if (jobId) {
    const job = getJob(jobId);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.status(200).json(job);
    return;
  }

  res.status(200).json({ jobs: listJobs() });
}
