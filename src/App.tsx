import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { NotFound } from './components/AccessGate'
import { PublicShell } from './components/layout/PublicShell'
import { RevealManager, ThemeApplier, Toasts } from './components/System'
import { AdminAnnouncements } from './pages/admin/AdminAnnouncements'
import { AdminCenters } from './pages/admin/AdminCenters'
import { AdminContent } from './pages/admin/AdminContent'
import { AdminCourses } from './pages/admin/AdminCourses'
import { AdminFeatures } from './pages/admin/AdminFeatures'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminOverview } from './pages/admin/AdminOverview'
import { AdminPackages } from './pages/admin/AdminPackages'
import { AdminPages } from './pages/admin/AdminPages'
import { AdminPeople } from './pages/admin/AdminPeople'
import { AdminPermissions } from './pages/admin/AdminPermissions'
import { AdminTheme } from './pages/admin/AdminTheme'
import { BuilderPage } from './pages/public/Builder'
import { PlaylistPage, ResourcePage, VideoPage } from './pages/public/ContentPages'
import { CourseDetailPage } from './pages/public/CourseDetail'
import { CoursesPage } from './pages/public/Courses'
import { FaqPage } from './pages/public/Faq'
import { PreviewPage } from './pages/public/Preview'
import { TeacherChannelPage } from './pages/public/TeacherChannel'
import { TeachersPage } from './pages/public/Teachers'
import { TemplatePage } from './pages/public/TemplatePages'
import { StudentCourses } from './pages/student/StudentCourses'
import { StudentLayout } from './pages/student/StudentLayout'
import { StudentOverview } from './pages/student/StudentOverview'
import { StudentProfile } from './pages/student/StudentProfile'
import { StudentResources } from './pages/student/StudentResources'
import { StudentSaved } from './pages/student/StudentSaved'
import { StudentSubscription } from './pages/student/StudentSubscription'
import { StudentTimetable } from './pages/student/StudentTimetable'
import { StudentVideos } from './pages/student/StudentVideos'
import { StudioChannel } from './pages/teacher/StudioChannel'
import { StudioGroups } from './pages/teacher/StudioGroups'
import { StudioOverview } from './pages/teacher/StudioOverview'
import { StudioPlaylists } from './pages/teacher/StudioPlaylists'
import { StudioResources } from './pages/teacher/StudioResources'
import { StudioSubjects } from './pages/teacher/StudioSubjects'
import { StudioVideos } from './pages/teacher/StudioVideos'
import { StudioVisibility } from './pages/teacher/StudioVisibility'
import { TeacherLayout } from './pages/teacher/TeacherLayout'

export default function App() {
  return (
    <BrowserRouter>
      <ThemeApplier />
      <RevealManager />
      <Routes>
        <Route element={<PublicShell />}>
          <Route index element={<TemplatePage page="home" />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:id" element={<CourseDetailPage />} />
          <Route path="teachers" element={<TeachersPage />} />
          <Route path="teachers/:id" element={<TeacherChannelPage />} />
          <Route path="videos/:id" element={<VideoPage />} />
          <Route path="playlists/:id" element={<PlaylistPage />} />
          <Route path="resources/:id" element={<ResourcePage />} />
          <Route path="builder" element={<BuilderPage />} />
          <Route path="preview" element={<PreviewPage />} />
          <Route path="how-it-works" element={<TemplatePage page="howItWorks" />} />
          <Route path="centers" element={<TemplatePage page="centers" />} />
          <Route path="faq" element={<FaqPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="pages" element={<AdminPages />} />
          <Route path="theme" element={<AdminTheme />} />
          <Route path="features" element={<AdminFeatures />} />
          <Route path="courses" element={<AdminCourses />} />
          <Route path="content" element={<AdminContent />} />
          <Route path="people" element={<AdminPeople />} />
          <Route path="centers" element={<AdminCenters />} />
          <Route path="packages" element={<AdminPackages />} />
          <Route path="permissions" element={<AdminPermissions />} />
          <Route path="announcements" element={<AdminAnnouncements />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
        <Route path="teacher" element={<TeacherLayout />}>
          <Route index element={<StudioOverview />} />
          <Route path="subjects" element={<StudioSubjects />} />
          <Route path="videos" element={<StudioVideos />} />
          <Route path="playlists" element={<StudioPlaylists />} />
          <Route path="resources" element={<StudioResources />} />
          <Route path="groups" element={<StudioGroups />} />
          <Route path="channel" element={<StudioChannel />} />
          <Route path="visibility" element={<StudioVisibility />} />
          <Route path="*" element={<Navigate to="/teacher" replace />} />
        </Route>
        <Route path="student" element={<StudentLayout />}>
          <Route index element={<StudentOverview />} />
          <Route path="subscription" element={<StudentSubscription />} />
          <Route path="courses" element={<StudentCourses />} />
          <Route path="timetable" element={<StudentTimetable />} />
          <Route path="videos" element={<StudentVideos />} />
          <Route path="resources" element={<StudentResources />} />
          <Route path="saved" element={<StudentSaved />} />
          <Route path="profile" element={<StudentProfile />} />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Route>
      </Routes>
      <Toasts />
    </BrowserRouter>
  )
}
