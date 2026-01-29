import React from 'react'

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null, errorInfo: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true }
    }

    componentDidCatch(error, errorInfo) {
        console.error('Error caught by boundary:', error, errorInfo)
        this.setState({ error, errorInfo })
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    width: '100vw',
                    height: '100vh',
                    background: '#1a1a2e',
                    color: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '40px'
                }}>
                    <h1 style={{ color: '#ff6b6b', marginBottom: '20px' }}>Something went wrong 😢</h1>
                    <div style={{
                        background: 'rgba(255, 107, 107, 0.1)',
                        padding: '20px',
                        borderRadius: '8px',
                        maxWidth: '600px',
                        marginBottom: '20px'
                    }}>
                        <h3>Error Details:</h3>
                        <pre style={{
                            overflow: 'auto',
                            fontSize: '12px',
                            whiteSpace: 'pre-wrap'
                        }}>
                            {this.state.error && this.state.error.toString()}
                        </pre>
                        {this.state.errorInfo && (
                            <pre style={{
                                overflow: 'auto',
                                fontSize: '11px',
                                marginTop: '10px',
                                whiteSpace: 'pre-wrap'
                            }}>
                                {this.state.errorInfo.componentStack}
                            </pre>
                        )}
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '12px 24px',
                            background: '#4f46e5',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '16px',
                            cursor: 'pointer'
                        }}
                    >
                        Reload Page
                    </button>
                </div>
            )
        }

        return this.props.children
    }
}

export default ErrorBoundary
