import { Component } from 'react'
import type { ReactNode } from 'react'
import { TileError } from './primitives'

interface Props { tileId: string; children: ReactNode }
interface State { hasError: boolean }

export class TileErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(err: Error) {
    console.error(`[Dashboard] Tile "${this.props.tileId}" crashed:`, err)
  }

  render() {
    if (this.state.hasError) {
      return <TileError message="Tile error" onRetry={() => this.setState({ hasError: false })} />
    }
    return this.props.children
  }
}
