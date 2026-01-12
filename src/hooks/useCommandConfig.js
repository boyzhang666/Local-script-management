import { useQuery } from '@tanstack/react-query';
import { getCommandConfig } from '@/api/commandConfig';

export function useCommandConfig() {
  return useQuery({
    queryKey: ['command-config'],
    queryFn: getCommandConfig,
    staleTime: 60_000,
  });
}

