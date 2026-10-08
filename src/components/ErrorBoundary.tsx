import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

// Last line of defence: an error while rendering shows a short message with a reload button
// instead of a blank page.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="gg-crash" role="alert">
        <p className="gg-crash-title">Something went wrong</p>
        <p>The globe hit an unexpected error. Reloading the page usually fixes it.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
