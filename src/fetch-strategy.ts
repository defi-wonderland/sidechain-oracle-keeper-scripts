import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import {providers, Wallet} from 'ethers';
import dotenv from 'dotenv';
import {getEnvVariable} from './utils/misc';

dotenv.config();

/* ==============================================================/*
                          SETUP
/*============================================================== */

// environment variables usage
const provider = new providers.WebSocketProvider(getEnvVariable('RPC_WSS_URI'));
const txSigner = new Wallet(getEnvVariable('TX_SIGNER_PRIVATE_KEY'), provider);

const {dataFeedJob: job, dataFeed} = getMainnetSdk(txSigner);

/* ==============================================================/*
                      AVAILABLE POOLS
/*============================================================== */

export async function getAllWhitelistedSalts(): Promise<string[]> {
  dataFeed.attach(await job.dataFeed()); // Enforces dataFeed to be the job's one
  const whitelistedSalts = await dataFeed.whitelistedPools();
  return whitelistedSalts;
}
