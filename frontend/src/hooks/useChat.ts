import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { apiClient } from '../api/client';
import type { AgentMessage, ChatResponse, FeatureOverrideMap } from '../types';

export function useChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['chat'],
    mutationFn: async (payload: {
      messages: AgentMessage[];
      sessionId: string;
      feature_overrides?: FeatureOverrideMap;
    }) => {
      const { messages, sessionId, feature_overrides } = payload;
      const { data } = await apiClient.post<ChatResponse>('/chat', {
        messages,
        sessionId,
        feature_overrides
      });
      return data;
    },
    onSuccess: (data) => {
      if (data.citations.length) {
        toast.success(`Found ${data.citations.length} citations`);
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error ?? error?.message ?? 'Failed to send message';
      toast.error(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] });
    }
  });
}
