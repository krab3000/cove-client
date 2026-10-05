import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { authFailure } from '../api/cove';

// The app in front is "focused" (React Native has no window focus).
AppState.addEventListener('change', (state) =>
  focusManager.setFocused(state === 'active')
);

/** One per session: a new sign-in starts with an empty cache. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        // Once more after a failure, but not when the session ran out
        retry: (count, error) => count < 1 && authFailure(error) !== 'expired',
      },
    },
  });
}
