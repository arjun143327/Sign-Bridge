import { useState } from 'react'
import './Lobby.css'

function Lobby({ userId, onJoinMeeting }) {
    const [meetingCode, setMeetingCode] = useState('')

    const handleJoinClick = () => {
        if (meetingCode.trim().length === 6) {
            onJoinMeeting(meetingCode.toUpperCase())
        }
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

    return (
        <div className="lobby">
            <div className="lobby-background"></div>
            <div className="lobby-content">
                <div className="lobby-card">
                    <h1 className="lobby-title">ISL Translator</h1>
                    <p className="lobby-subtitle">Real-time Sign Language Translation</p>

                    <div className="user-id-section">
                        <p className="user-id-label">YOUR ID</p>
                        <p className="user-id">{userId}</p>
                    </div>

                    <input
                        type="text"
                        className="meeting-input"
                        placeholder="Enter Meeting ID"
                        value={meetingCode}
                        onChange={handleInputChange}
                        onKeyPress={handleKeyPress}
                        maxLength={6}
                    />

                    <button
                        className="join-button"
                        onClick={handleJoinClick}
                        disabled={meetingCode.length !== 6}
                    >
                        Join Meeting
                    </button>

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
