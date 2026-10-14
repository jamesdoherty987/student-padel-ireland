import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { usePageSeo } from '../hooks/usePageSeo'
import { getAllPosts } from '../data/blogPosts'
import './Blog.css'
import './Legal.css'

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function BlogPage() {
  usePageSeo({
    title: 'Student Padel Ireland Blog',
    description:
      'Guides to student padel in Ireland — tournaments, rankings, beginners tips, and how university clubs use Student Padel Ireland.',
    path: '/blog',
  })

  const posts = getAllPosts()

  return (
    <div className="app-shell">
      <NavBar />
      <main className="page blog-page blog-page--index">
        <p className="eyebrow">
          <Link to="/">← Home</Link>
        </p>
        <h1 className="page-title">Blog</h1>
        <p className="blog-lead">
          Guides and updates for student padel across Ireland — how to join tournaments, climb rankings, and
          grow campus clubs on Student Padel Ireland.
        </p>

        <ul className="blog-grid">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link to={`/blog/${post.slug}`} className="blog-card">
                <div className="blog-meta">
                  <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                  <span>{post.readingMinutes} min read</span>
                </div>
                <h2>{post.title}</h2>
                <p>{post.description}</p>
                <div className="blog-tags">
                  {post.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="blog-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
