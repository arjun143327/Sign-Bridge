import { useState } from 'react'
import './Lobby.css'

function Lobby({ userId, onJoinMeeting }) {
    const [meetingCode, setMeetingCode] = useState('')
    const [copySuccess, setCopySuccess] = useState(false)

    const handleJoinClick = () => {
        if (meetingCode.trim().length === 6) {
            onJoinMeeting(meetingCode.toUpperCase())
        }
    }

    const handleStartMeeting = () => {
        // Host joins with their own ID
        onJoinMeeting(userId)
    }

    const handleInputChange = (e) => {
        const value = e.target.value.toUpperCase()
        if (value.length <= 6) {
            setMeetingCode(value)
        }
    }

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && meetingCode.trim().length === 6) {
            handleJoinClick()
        }
    }

    const handlePaste = (e) => {
        e.preventDefault()
        const pastedText = e.clipboardData.getData('text')
        // Extract only alphanumeric characters
        const cleanedText = pastedText.replace(/[^A-Z0-9]/gi, '').toUpperCase()
        // Take only first 6 characters
        const validCode = cleanedText.slice(0, 6)
        setMeetingCode(validCode)
    }

    const handleCopyId = async () => {
        try {
            await navigator.clipboard.writeText(userId)
            setCopySuccess(true)
            setTimeout(() => setCopySuccess(false), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    return (
        <div className="lobby">
            <div className="lobby-background"></div>
            <div className="lobby-content">
                <div className="lobby-card">
                    <h1 className="lobby-title">ISL Translator</h1>
                    <p className="lobby-subtitle">Real-time Sign Language Translation</p>

                    <div className="user-id-section">
                        <p className="user-id-label">YOUR ID</p>
                        <div className="user-id-container">
                            <p className="user-id">{userId}</p>
                            <button
                                className="copy-button"
                                onClick={handleCopyId}
                                title="Copy ID"
                            >
                                {copySuccess ? (
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="action-divider">
                        <span>OR</span>
                    </div>

                    <button
                        className="start-meeting-button"
                        onClick={handleStartMeeting}
                    >
                        Start Instant Meeting
                    </button>

                    <div className="join-section">
                        <input
                            type="text"
                            className="meeting-input"
                            placeholder="Enter Host ID to Join"
                            value={meetingCode}
                            onChange={handleInputChange}
                            onKeyPress={handleKeyPress}
                            onPaste={handlePaste}
                            maxLength={6}
                        />

                        <button
                            className="join-button"
                            onClick={handleJoinClick}
                            disabled={meetingCode.length !== 6}
                        >
                            Join Meeting
                        </button>
                    </div>

                    <div className="service-status">
                        <span className="status-dot"></span>
                        <span className="status-text">Service Active</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Lobby
