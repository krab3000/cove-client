import { createContext, useContext } from 'react';
import type { CoveClient } from '../api/cove';

/** The signed-in session's client, for everything under the Library (App provides it). */
export const ClientContext = createContext<CoveClient | null>(null);

export function useClient(): CoveClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useClient outside a signed-in session');
  return client;
}
