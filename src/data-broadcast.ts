import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import type {Event} from 'ethers';
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
const MAX_RETRIES = 3;
const RETRY_INTERVAL = 60_000;

// Environment variables usage
const provider = new providers.JsonRpcProvider(getEnvVariable('RPC_WSS_URI'));
const txSigner = new Wallet(getEnvVariable('TX_SIGNER_PRIVATE_KEY'), provider);
const bundleSigner = new Wallet(getEnvVariable('BUNDLE_SIGNER_PRIVATE_KEY'), provider);

const {dataFeedJob: job, dataFeed} = getMainnetSdk(txSigner);

const failedEventsQueue: Array<{event: EventData; retries: number}> = [];

type PoolObservedEvent = {
  _poolSalt: string;
  _poolNonce: number;
  _observationsData: Array<[number, number]>;
};

type EventData = {
  block: providers.Block;
  chainId: number;
  poolSalt: string;
  poolNonce: number;
  observationsData: Array<[number, number]>;
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
          await handleTransaction(chainId, poolSalt, poolNonce, observationsData, block, flashbotBroadcastor);
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

async function handleTransaction(
  chainId: number,
  poolSalt: string,
  poolNonce: number,
  observationsData: Array<[number, number]>,
  block: providers.Block,
  flashbotBroadcastor: FlashbotsBroadcastor,
  retries = 0,
): Promise<void> {
  flashbotBroadcastor
    .tryToWorkOnFlashbots({
      jobContract: job,
      workMethod: WORK_METHOD,
      workArguments: [chainId, poolSalt, poolNonce, observationsData],
      block,
    })
    .catch((error) => {
      console.error(`Transaction failed for chainId ${chainId}, retry ${retries}`, error);
      if (retries < MAX_RETRIES) {
        setTimeout(
          async () => handleTransaction(chainId, poolSalt, poolNonce, observationsData, block, flashbotBroadcastor, retries + 1),
          RETRY_INTERVAL,
        );
      } else {
        failedEventsQueue.push({event: {chainId, poolSalt, poolNonce, observationsData, block}, retries});
      }
    });
}

async function processFailedEvents(flashbotBroadcastor: FlashbotsBroadcastor) {
  const failedEventsResend = failedEventsQueue.map(async (failedEvent) => {
    const {event, retries} = failedEvent;
    return handleTransaction(
      event.chainId,
      event.poolSalt,
      event.poolNonce,
      event.observationsData,
      event.block,
      flashbotBroadcastor,
      retries,
    ).catch((error) => {
      console.error(`Failed to process queued event after ${retries} retries`, error);
      failedEventsQueue.push(failedEvent);
    });
  });
  failedEventsQueue.length = 0;
  await Promise.all(failedEventsResend);
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
        await handleTransaction(chainId, poolSalt, poolNonce, observationsData, block, flashbotBroadcastor);
      }),
    );
  });

  setInterval(async () => {
    await processFailedEvents(flashbotBroadcastor);
  }, RETRY_INTERVAL);
}

(async () => {
  await initialize();
  await run();
})();
