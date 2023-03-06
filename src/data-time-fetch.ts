import {providers, Wallet} from 'ethers';
import {FlashbotsBundleProvider} from '@flashbots/ethers-provider-bundle';
import {FlashbotsBroadcastor, BlockListener} from '@keep3r-network/keeper-scripting-utils';
import dotenv from 'dotenv';
import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import {getEnvVariable} from './utils/misc';
import {getAllWhitelistedSalts} from './fetch-strategy';

dotenv.config();

/* ==============================================================/*
                          SETUP
/*============================================================== */

const GAS_LIMIT = 700_000;
const PRIORITY_FEE = 2e9;
const WORK_METHOD = 'work(bytes32,uint8)';

// Environment variables usage
const provider = new providers.WebSocketProvider(getEnvVariable('RPC_WSS_URI'));
const txSigner = new Wallet(getEnvVariable('TX_SIGNER_PRIVATE_KEY'), provider);
const bundleSigner = new Wallet(getEnvVariable('BUNDLE_SIGNER_PRIVATE_KEY'), provider);

const {dataFeedJob: job} = getMainnetSdk(txSigner);

const blockListener = new BlockListener(provider);

// 1: Cooldown time has passed since the last worked timestamp
// 2: Twap difference between pool and oracle has crossed the threshold
const triggerReason = 1;

/* ==============================================================/*
                       MAIN SCRIPT
/*============================================================== */

export async function run(): Promise<void> {
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, bundleSigner);
  const flashbotBroadcastor = new FlashbotsBroadcastor(flashbotsProvider, PRIORITY_FEE, GAS_LIMIT);

  // Create a subscription and start listening to upcoming blocks
  blockListener.stream(async (block) => {
    // In each block, try to work every supported pool
    const WHITELISTED_POOL_SALTS = await getAllWhitelistedSalts();
    await Promise.all(
      WHITELISTED_POOL_SALTS.map(async (poolSalt) => {
        await flashbotBroadcastor.tryToWorkOnFlashbots(job, WORK_METHOD, [poolSalt, triggerReason], block);
      }),
    );
  });
}

(async () => {
  await run();
})();
