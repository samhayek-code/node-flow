import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render-phase crashes so a bad component/state can't white-screen the
 *  whole tool. Offers a reload (autosaved work survives) and a hard reset that
 *  drops the persisted project in case it is what's crashing. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[node-flow] uncaught error:", error, info.componentStack);
  }

  private reload = () => window.location.reload();

  private reset = () => {
    // Drop the autosave so a corrupt persisted doc can't re-crash on reload.
    try {
      indexedDB.deleteDatabase("nodeflow");
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="nv-overlay nv-error-overlay">
        <div className="nv-modal" role="alertdialog" aria-label="Application error">
          <div className="nv-modal-title">Something broke</div>
          <p className="nv-error-msg">
            The interface hit an unexpected error. Your last work is autosaved — reload to recover, or
            reset the project if it keeps happening.
          </p>
          <pre className="nv-error-detail">{error.message}</pre>
          <div className="nv-modal-actions">
            <button className="nv-btn-ghost" onClick={this.reset}>
              Reset project
            </button>
            <button className="nv-export" onClick={this.reload}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
