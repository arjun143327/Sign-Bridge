import { useState, useEffect } from 'react'
import Lobby from './components/Lobby'
import Meeting from './components/Meeting'
import './App.css'

function App() {
    const [inMeeting, setInMeeting] = useState(false)
    const [userId, setUserId] = useState('')
    const [meetingId, setMeetingId] = useState('')

    useEffect(() => {
        // Generate random 6-character user ID
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        let id = ''
        for (let i = 0; i < 6; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        setUserId(id)
    }, [])

    const handleJoinMeeting = (meetingCode) => {
        setMeetingId(meetingCode)
        setInMeeting(true)
    }

    const handleLeaveMeeting = () => {
        setInMeeting(false)
        setMeetingId('')
    }

    return (
        <>
            {!inMeeting ? (
                <Lobby userId={userId} onJoinMeeting={handleJoinMeeting} />
            ) : (
                <Meeting meetingId={meetingId} userId={userId} onLeaveMeeting={handleLeaveMeeting} />
            )}
        </>
    )
}

export default App
