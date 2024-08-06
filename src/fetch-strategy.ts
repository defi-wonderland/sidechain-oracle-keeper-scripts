import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import {providers} from 'ethers';
import {getEnvVariable} from '@keep3r-network/keeper-scripting-utils';

/* ==============================================================/*
                          SETUP
/*============================================================== */

// environment variables usage
const provider = new providers.WebSocketProvider(getEnvVariable('RPC_HTTP_MAINNET_URI'));
const {dataFeedJob: job, dataFeed} = getMainnetSdk(provider);

/* ==============================================================/*
                      AVAILABLE POOLS
/*============================================================== */

export async function getAllWhitelistedSalts(): Promise<string[]> {
  dataFeed.attach(await job.dataFeed()); // Enforces dataFeed to be the job's one
  const whitelistedSalts = await dataFeed.whitelistedPools();
  return whitelistedSalts;
}
