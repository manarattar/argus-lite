import { Component } from 'react'

/** If something on the page breaks, say so plainly instead of leaving a blank screen. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ARGUS-Lite crashed:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>The page hit an error and stopped. Reload it and run the example again; it takes about half a minute.</p>
          <p className="crash-detail">{String(this.state.error.message || this.state.error)}</p>
          <button onClick={() => window.location.reload()}>Reload the page</button>
        </div>
      </div>
    )
  }
}
