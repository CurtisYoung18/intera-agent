import UserProfileWorkspace from '@/components/operate/user-profile-workspace'

export default async function OperateUserProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  return <UserProfileWorkspace userId={userId} />
}
