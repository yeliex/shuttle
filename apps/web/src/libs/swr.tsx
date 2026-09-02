import type { PropsWithChildren } from 'react';
import { SWRConfig, type SWRConfiguration } from 'swr';
import { requestJson } from './fetch.ts';

export const swrFetcher = <Data = unknown>(url: string) => requestJson<Data>(url);

const DEFAULT_CONFIG = {
    fetcher: swrFetcher,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    loadingTimeout: 3000,
    dedupingInterval: 2000,
} satisfies SWRConfiguration;

export function SWRProvider({ children }: PropsWithChildren) {
    return <SWRConfig value={DEFAULT_CONFIG}>{children}</SWRConfig>;
}
