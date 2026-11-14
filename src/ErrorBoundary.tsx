import { Component, type ReactNode } from 'react';

/** If the app crashes while drawing the page, this shows what happened and a Reload button instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>BobGPT hit an error and stopped. Your saved chats are still in this browser; reloading usually fixes it.</p>
        <pre>{this.state.error.message}</pre>
        <button className="secondary-button" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
