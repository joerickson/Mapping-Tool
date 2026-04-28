import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase/client'

export default function LogoutPage() {
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.signOut().finally(() => {
      navigate('/login', { replace: true })
    })
  }, [navigate])

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
