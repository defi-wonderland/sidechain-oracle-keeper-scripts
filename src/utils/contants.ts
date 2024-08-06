// Blocks in the past to read events from
export const PAST_BLOCKS = 14_400; // 2d

export const SUPPORTED_CHAIN_IDS = [10, 137];

type ContractDetails = {
  job: string;
  dataFeed: string;
};

type ContractsMapping = Record<number, ContractDetails>;

export const contracts: ContractsMapping = {
  1: {
    job: '0x1f5f0DA9391AB08c7F0150d45B41F6900fb4Fd0C',
    dataFeed: '0x1ce81290Eb4c10cC9Fa71256799665423e87b628',
  },
  11_155_111: {
    job: '0x6c461C0296eBE3715820F1Cbde856219e06ac3B8',
    dataFeed: '0x553365bdda2Fd60608Fb05CB7ad32620e3A126DD',
  },
};
