import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { getAllPosts } from '../data/blogPosts'
import { appHomePath } from '../utils/navigation'
import './Blog.css'
import './Legal.css'

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Quiet SEO index — not linked from the main app UI. */
export default function BlogPage() {
  const { user } = useAuth()
  const backTo = appHomePath(user?.role)

  usePageSeo({
    title: 'Student Padel Ireland Guides',
    description:
      'Guides to student padel in Ireland — tournaments, rankings, beginners tips, and campus clubs on Student Padel Ireland.',
    path: '/blog',
  })

  const posts = getAllPosts()

  return (
    <div className="app-shell blog-shell">
      <main className="page blog-page blog-page--index">
        <p className="eyebrow">
          <Link to={backTo}>← Student Padel Ireland</Link>
        </p>
        <h1 className="page-title">Guides</h1>
        <p className="blog-lead">Notes on student padel across Ireland.</p>

        <ul className="blog-grid">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link to={`/blog/${post.slug}`} className="blog-card">
                <div className="blog-meta">
                  <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                </div>
                <h2>{post.title}</h2>
                <p>{post.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
