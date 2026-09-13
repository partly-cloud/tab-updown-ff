/**
 * Shared WebExtension API mock/stub helper.
 *
 * Later tests (background script, content script, options page) need a
 * controllable stand-in for the promise-based `browser.*` namespace. This
 * module builds a minimal mock covering the surface those tests use:
 *
 *   - browser.storage.local  (get / set)
 *   - browser.commands       (getAll / update / reset / onCommand)
 *   - browser.tabs           (query / sendMessage)
 *   - browser.runtime        (onMessage)
 *
 * Event objects (`onCommand`, `onMessage`) expose `addListener` /
 * `removeListener` plus a test-only `dispatch(...)` helper that invokes every
 * registered listener, so tests can simulate the browser firing an event.
 */

export interface MockEvent<Listener extends (...args: never[]) => unknown> {
  addListener: jest.Mock<void, [Listener]>;
  removeListener: jest.Mock<void, [Listener]>;
  hasListener: jest.Mock<boolean, [Listener]>;
  /** Test-only: invoke all registered listeners with the given args. */
  dispatch: (...args: Parameters<Listener>) => Array<ReturnType<Listener>>;
  /** Test-only: the currently registered listeners. */
  listeners: Listener[];
}

function createMockEvent<
  Listener extends (...args: never[]) => unknown,
>(): MockEvent<Listener> {
  const listeners: Listener[] = [];

  return {
    listeners,
    addListener: jest.fn((listener: Listener) => {
      listeners.push(listener);
    }),
    removeListener: jest.fn((listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }),
    hasListener: jest.fn((listener: Listener) => listeners.includes(listener)),
    dispatch: (...args: Parameters<Listener>) =>
      listeners.map((listener) => listener(...args) as ReturnType<Listener>),
  };
}

export interface StorageChange {
  [key: string]: unknown;
}

export interface MockBrowser {
  storage: {
    local: {
      get: jest.Mock<Promise<Record<string, unknown>>, [unknown?]>;
      set: jest.Mock<Promise<void>, [Record<string, unknown>]>;
    };
  };
  commands: {
    getAll: jest.Mock<Promise<Array<{ name?: string; shortcut?: string }>>, []>;
    update: jest.Mock<Promise<void>, [{ name: string; shortcut?: string }]>;
    reset: jest.Mock<Promise<void>, [string]>;
    onCommand: MockEvent<(command: string) => void>;
  };
  tabs: {
    query: jest.Mock<
      Promise<Array<{ id?: number; active?: boolean }>>,
      [Record<string, unknown>]
    >;
    sendMessage: jest.Mock<Promise<unknown>, [number, unknown]>;
  };
  runtime: {
    onMessage: MockEvent<
      (
        message: unknown,
        sender: unknown,
        sendResponse: (response?: unknown) => void,
      ) => unknown
    >;
  };
}

/**
 * Options for seeding the mock's initial state.
 */
export interface CreateMockBrowserOptions {
  /** Initial contents of `storage.local`. Defaults to empty. */
  storage?: Record<string, unknown>;
  /** Values returned by `commands.getAll()`. Defaults to empty. */
  commands?: Array<{ name?: string; shortcut?: string }>;
  /** Tabs returned by `tabs.query()`. Defaults to empty. */
  tabs?: Array<{ id?: number; active?: boolean }>;
}

/**
 * Create a fresh mock `browser` object with backing state.
 *
 * `storage.local.get`/`set` operate against an in-memory store so tests can do
 * round-trip persistence checks. `commands`, `tabs`, and `runtime` are backed
 * by seedable values and controllable event helpers.
 */
export function createMockBrowser(
  options: CreateMockBrowserOptions = {},
): MockBrowser {
  const store: Record<string, unknown> = { ...(options.storage ?? {}) };
  const commandList = options.commands ?? [];
  const tabList = options.tabs ?? [];

  return {
    storage: {
      local: {
        get: jest.fn(async (query?: unknown) => {
          if (query == null) {
            return { ...store };
          }
          if (typeof query === "string") {
            return query in store ? { [query]: store[query] } : {};
          }
          if (Array.isArray(query)) {
            const result: Record<string, unknown> = {};
            for (const key of query) {
              if (typeof key === "string" && key in store) {
                result[key] = store[key];
              }
            }
            return result;
          }
          // Object form: keys with default values.
          const result: Record<string, unknown> = {};
          for (const [key, defaultValue] of Object.entries(
            query as Record<string, unknown>,
          )) {
            result[key] = key in store ? store[key] : defaultValue;
          }
          return result;
        }),
        set: jest.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
    commands: {
      getAll: jest.fn(async () => commandList.map((command) => ({ ...command }))),
      update: jest.fn(
        async (_details: { name: string; shortcut?: string }) => undefined,
      ),
      reset: jest.fn(async (_name: string) => undefined),
      onCommand: createMockEvent<(command: string) => void>(),
    },
    tabs: {
      query: jest.fn(async (_query: Record<string, unknown>) =>
        tabList.map((tab) => ({ ...tab })),
      ),
      sendMessage: jest.fn(
        async (_tabId: number, _message: unknown) => undefined,
      ),
    },
    runtime: {
      onMessage: createMockEvent<
        (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => unknown
      >(),
    },
  };
}

/**
 * Install a mock `browser` onto `globalThis` and return it. Also returns a
 * `restore()` to remove it after the test.
 */
export function installMockBrowser(
  options: CreateMockBrowserOptions = {},
): { browser: MockBrowser; restore: () => void } {
  const mock = createMockBrowser(options);
  const globalObject = globalThis as unknown as { browser?: unknown };
  const previous = globalObject.browser;
  globalObject.browser = mock;
  return {
    browser: mock,
    restore: () => {
      globalObject.browser = previous;
    },
  };
}
