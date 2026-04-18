import { SignIn } from '@clerk/clerk-react'

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-700">RBM Geo</h1>
          <p className="text-gray-500 mt-1">Portfolio Intelligence Platform</p>
        </div>
        <SignIn
          routing="path"
          path="/sign-in"
          afterSignInUrl="/map"
          signUpUrl="/sign-up"
        />
      </div>
    </div>
  )
}
