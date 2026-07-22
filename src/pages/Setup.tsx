import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import SetupWizard from '@/components/setup/SetupWizard'

export default function Setup() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  // Setup requires an account, same guard as the console.
  useEffect(() => {
    if (!loading && !session) navigate('/login')
  }, [loading, session, navigate])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    )
  }
  if (!session) return null

  return <SetupWizard userId={session.user.id} />
}
