import type {Contract} from 'ethers';

/* ==============================================================/*
                      AVAILABLE POOLS
/*============================================================== */

export async function getAllWhitelistedSalts(dataFeed: Contract, job: Contract): Promise<string[]> {
  dataFeed.attach(await job.dataFeed()); // Enforces dataFeed to be the job's one
  const whitelistedSalts = await dataFeed.whitelistedPools();
  return whitelistedSalts;
}
