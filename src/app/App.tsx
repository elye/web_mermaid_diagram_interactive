/**
 * App
 * ---
 * Root component. Wires providers, renders the main layout.
 *
 * Public API: <App />
 * Dependencies: ThemeProvider, StoreProvider, ShortcutProvider, Layout
 */
import { ThemeProvider } from './providers/ThemeProvider';
import { StoreProvider } from './providers/StoreProvider';
import { ShortcutProvider } from './providers/ShortcutProvider';
import { Layout } from './Layout';

export function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <ShortcutProvider>
          <Layout />
        </ShortcutProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
