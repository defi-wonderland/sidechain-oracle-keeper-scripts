import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import type {TransactionRequest} from '@ethersproject/abstract-provider';
import type {Contract, Event} from 'ethers';
import {providers, Wallet} from 'ethers';
import {FlashbotsBundleProvider} from '@flashbots/ethers-provider-bundle';
import {FlashbotsBroadcastor} from '@keep3r-network/keeper-scripting-utils';
import dotenv from 'dotenv';
import {getEnvVariable} from './utils/misc';
import {PAST_BLOCKS, SUPPORTED_CHAIN_IDS} from './utils/contants';

dotenv.config();

/* ==============================================================/*
                          SETUP
/*============================================================== */

const GAS_LIMIT = 700_000;
const WORK_METHOD = 'work(uint32,bytes32,uint24,(uint32,int24)[])';
const PRIORITY_FEE = 2e9;

// Environment variables usage
const provider = new providers.WebSocketProvider(getEnvVariable('RPC_WSS_URI'));
const txSigner = new Wallet(getEnvVariable('TX_SIGNER_PRIVATE_KEY'), provider);
const bundleSigner = new Wallet(getEnvVariable('BUNDLE_SIGNER_PRIVATE_KEY'), provider);

const {dataFeedJob: job, dataFeed} = getMainnetSdk(txSigner);

// Flag to track if there's a transaction in progress. Pool salt + pool nonce => status
const txInProgress: Record<string, boolean> = {};

type PoolObservedEvent = {
  _poolSalt: string;
  _poolNonce: number;
  _observationsData: Array<[number, number]>;
};

/* ==============================================================/*
                       MAIN SCRIPT
/*============================================================== */

export async function initialize(): Promise<void> {
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, bundleSigner);
  const flashbotBroadcastor = new FlashbotsBroadcastor(flashbotsProvider, PRIORITY_FEE, GAS_LIMIT);

  dataFeed.attach(await job.dataFeed()); // Enforces dataFeed to be the job's one

  const block = await provider.getBlock('latest');
  const queryBlock = block.number - PAST_BLOCKS;
  // eslint-disable-next-line new-cap
  const evtFilter = dataFeed.filters.PoolObserved();
  const queryResults = await dataFeed.queryFilter(evtFilter, queryBlock);
  console.info('Reading PoolObserved events since block', queryBlock);

  await Promise.all(
    queryResults.map(async (event: Event) => {
      const {poolSalt, poolNonce, observationsData} = parseEvent(event);
      const block = await provider.getBlock('latest');
      await Promise.all(
        SUPPORTED_CHAIN_IDS.map(async (chainId) => {
          return flashbotBroadcastor.tryToWorkOnFlashbots(job, WORK_METHOD, [poolSalt, poolNonce, chainId, observationsData], block);
        }),
      );
    }),
  );
}

function parseEvent(event: Event): {poolSalt: string; poolNonce: number; observationsData: Array<[number, number]>} {
  const parsedEvent = dataFeed.interface.decodeEventLog('PoolObserved', event.data, event.topics) as unknown as PoolObservedEvent;
  console.debug(`Parsing event`, {parsedEvent});
  const poolSalt = parsedEvent._poolSalt;
  const poolNonce = parsedEvent._poolNonce;
  const observationsData = parsedEvent._observationsData;
  return {poolSalt, poolNonce, observationsData};
}

export async function run(): Promise<void> {
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, bundleSigner);
  const flashbotBroadcastor = new FlashbotsBroadcastor(flashbotsProvider, PRIORITY_FEE, GAS_LIMIT);

  dataFeed.attach(await job.dataFeed()); // Enforces dataFeed to be the job's one

  console.info('Waiting for event PoolObserved...');
  // eslint-disable-next-line new-cap
  provider.on(dataFeed.filters.PoolObserved(), async (event: Event) => {
    /**
     * NOTE: codebase for manual fetching of events
     * const POOL_OBSERVED_EVENT_TOPIC = '0xbbea6ef77154be715a6de74ab5aae8710da33d74e2660ead1da5e867ea50d577'
     * const receipt = await provider.getTransactionReceipt('0xea8fd1a7588a0d016da6a08c17daeb26d73673e63e911281b5977935602dae40')
     * const event = receipt.logs.find((log) => log.topics[0] === POOL_OBSERVED_EVENT_TOPIC)
     */

    const block = await provider.getBlock(event.blockNumber);

    console.info(`Event arrived`, {event});
    const {poolSalt, poolNonce, observationsData} = parseEvent(event);

    console.info(`Data fetch`, {poolSalt, poolNonce, observationsData});
    await Promise.all(
      SUPPORTED_CHAIN_IDS.map(async (chainId) => {
        return flashbotBroadcastor.tryToWorkOnFlashbots(job, WORK_METHOD, [poolSalt, poolNonce, chainId, observationsData], block);
      }),
    );
  });
}

(async () => {
  await initialize();
  await run();
})();
