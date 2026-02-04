import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React error boundary caught:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center bg-black p-4 text-white">
          <h1 className="mb-4 text-xl font-bold text-red-400">Something went wrong</h1>
          <pre className="max-w-full overflow-auto rounded bg-neutral-900 p-4 text-sm text-neutral-300">
            {this.state.error?.message ?? "Unknown error"}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 border border-neutral-600 px-4 py-2 text-sm text-white hover:bg-neutral-900"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
