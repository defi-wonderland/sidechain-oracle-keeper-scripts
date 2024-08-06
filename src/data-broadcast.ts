import {getMainnetSdk} from '@dethcrypto/eth-sdk-client';
import type {Event} from 'ethers';
import {providers, Wallet} from 'ethers';
import {BlockListener, PrivateBroadcastor, getEnvVariable} from '@keep3r-network/keeper-scripting-utils';
import {PAST_BLOCKS, SUPPORTED_CHAIN_IDS} from './utils/contants';

/* ==============================================================/*
                          SETUP
/*============================================================== */

const GAS_LIMIT = 700_000;
const WORK_METHOD = 'work(uint32,bytes32,uint24,(uint32,int24)[])';
const PRIORITY_FEE = 2e9;
const CHAIN_ID = 1;
const builders = ['https://rpc.titanbuilder.xyz/', 'https://rpc.beaverbuild.org/'];

// Environment variables usage
const provider = new providers.JsonRpcProvider(getEnvVariable('RPC_HTTP_MAINNET_URI'));
const providerForLogs = new providers.JsonRpcProvider(getEnvVariable('RPC_HTTP_MAINNET_URI_FOR_LOGS'));
const txSigner = new Wallet(getEnvVariable('TX_SIGNER_PRIVATE_KEY'), provider);

const {dataFeedJob: job, dataFeed} = getMainnetSdk(txSigner);
// NOTE: this broadcastor only works for eth mainnet

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
  const broadcastor = new PrivateBroadcastor(builders, PRIORITY_FEE, GAS_LIMIT, true, CHAIN_ID);

  dataFeed.attach(await job.dataFeed()); // Enforces dataFeed to be the job's one
  dataFeed.connect(providerForLogs);

  const block = await provider.getBlock('latest');
  const queryBlock = block.number - PAST_BLOCKS;
  console.info('Reading PoolObserved events since block', queryBlock);

  // Query events and parse them
  const evtFilter = dataFeed.filters.PoolObserved();
  const queryResults = await dataFeed.queryFilter(evtFilter, queryBlock);
  const parsedEvents = queryResults.map((event) => parseEvent(event));

  // Extract unique poolSalts
  const uniquePoolSalts = new Set(parsedEvents.map((event) => event.poolSalt));

  // Sort events by poolNonce
  const sortedEvents = parsedEvents.sort((a, b) => a.poolNonce - b.poolNonce);

  const lastPoolNonceBridged: Record<string, Record<number, number>> = {};
  for (const poolSalt of uniquePoolSalts) {
    lastPoolNonceBridged[poolSalt] = {};
    await Promise.all(
      SUPPORTED_CHAIN_IDS.map(async (chainId) => {
        lastPoolNonceBridged[poolSalt][chainId] = await job.lastPoolNonceBridged(chainId, poolSalt);
      }),
    );
  }

  // Process each sorted event sequentially
  const blockListener = new BlockListener(provider);
  blockListener.stream(async (block: providers.Block) => {
    for (const event of sortedEvents) {
      const {poolSalt, poolNonce, observationsData} = event;

      for (const chainId of SUPPORTED_CHAIN_IDS) {
        const lastNonce = lastPoolNonceBridged[poolSalt][chainId];
        if (poolNonce <= lastNonce || poolNonce >= lastNonce + 10) {
          // TODO: remove max nonce limit
          console.info(`Skipping event`, {poolSalt, poolNonce});
          continue;
        }

        await broadcastor.tryToWork({
          jobContract: job,
          workMethod: WORK_METHOD,
          workArguments: [chainId, poolSalt, poolNonce, observationsData],
          block,
        });
      }
    }
  });
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
  const broadcastor = new PrivateBroadcastor(builders, PRIORITY_FEE, GAS_LIMIT, true, CHAIN_ID);

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
        await broadcastor.tryToWork({
          jobContract: job,
          workMethod: WORK_METHOD,
          workArguments: [chainId, poolSalt, poolNonce, observationsData],
          block,
        });
      }),
    );
  });
}

(async () => {
  await initialize();
  await run();
})();
