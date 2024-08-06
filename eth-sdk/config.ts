import {defineConfig} from '@dethcrypto/eth-sdk';

export default defineConfig({
  contracts: {
    sepolia: {
      dataFeedJob: '0x6c461C0296eBE3715820F1Cbde856219e06ac3B8',
      dataFeed: '0x553365bdda2Fd60608Fb05CB7ad32620e3A126DD',
    },
    mainnet: {
      dataFeedJob: '0x1f5f0DA9391AB08c7F0150d45B41F6900fb4Fd0C',
      dataFeed: '0x1ce81290Eb4c10cC9Fa71256799665423e87b628',
    },
  },
});
