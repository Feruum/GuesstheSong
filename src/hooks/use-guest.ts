"use client";
import { useSyncExternalStore } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GuestView } from "@/shared/contracts";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useGuest(): UseQueryResult<{ guest: GuestView }> {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const query = useQuery({ queryKey: ["guest"], queryFn: () => api<{ guest: GuestView }>("/guest"), staleTime: 600_000 });
  // A header fetch can populate the cache before a route hydrates. Match its
  // server-rendered guest state until React commits, then expose cached data.
  if (hydrated) return query;
  return {
    ...query,
    data: undefined, dataUpdatedAt: 0, error: null, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    status: "pending", fetchStatus: "fetching",
    isPending: true, isSuccess: false, isError: false,
    isLoading: true, isInitialLoading: true, isFetching: true,
    isLoadingError: false, isRefetchError: false, isRefetching: false,
    isFetched: false, isFetchedAfterMount: false, isPaused: false,
    isPlaceholderData: false, isStale: true,
  };
}
