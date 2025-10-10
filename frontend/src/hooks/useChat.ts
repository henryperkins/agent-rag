import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { apiClient } from '../api/client';
import type { AgentMessage, ChatResponse } from '../types';

export function useChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['chat'],
    mutationFn: async (payload: { messages: AgentMessage[]; sessionId: string }) => {
      const { data } = await apiClient.post<ChatResponse>('/chat', {
        messages: payload.messages,
        sessionId: payload.sessionId
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
