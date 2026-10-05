import { createContext } from 'react';

/**
 * Whether the filter editor sits on a surface (the tablet's drawer), where its rows go a step lighter than on the
 * phone's ground (nocturne.raised). The editor provides it; the rows read it.
 */
export const Raised = createContext(false);
