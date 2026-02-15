import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="error-boundary flex flex-col items-center justify-center gap-4 p-8 m-4 rounded-xl" role="alert">
          <h2 className="error-boundary__title text-lg font-semibold">Something went wrong</h2>
          <p className="error-boundary__message text-sm">{this.state.error?.message ?? 'Unknown error'}</p>
          <button
            onClick={this.handleReset}
            className="error-boundary__btn px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
            aria-label="Try again"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
