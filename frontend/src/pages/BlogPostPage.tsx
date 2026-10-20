import { useEffect } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePageSeo } from '../hooks/usePageSeo'
import { getPostBySlug, getRelatedPosts, type BlogBlock } from '../data/blogPosts'
import { appHomePath } from '../utils/navigation'
import './Blog.css'
import './Legal.css'

const SITE = 'https://www.studentpadel.ie'

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function Block({ block }: { block: BlogBlock }) {
  if (block.type === 'p') return <p>{block.text}</p>
  if (block.type === 'h2') return <h2>{block.text}</h2>
  if (block.type === 'ul') {
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
  }
  // Quiet CTA — text link only, no promo card
  return (
    <p className="blog-inline-cta">
      <Link to={block.to}>{block.label}</Link>
    </p>
  )
}

/** Quiet SEO article — not promoted in the main app UI. */
export default function BlogPostPage() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const backTo = appHomePath(user?.role)
  const post = getPostBySlug(slug)
  const related = post ? getRelatedPosts(post.slug, 2) : []

  usePageSeo(
    post
      ? {
          title: post.title,
          description: post.description,
          path: `/blog/${post.slug}`,
          type: 'article',
          publishedTime: post.publishedAt,
          modifiedTime: post.updatedAt || post.publishedAt,
          image: 'https://www.studentpadel.ie/images/student-padel-ireland-og.jpg',
        }
      : {
          title: 'Article not found',
          path: '/blog',
          noIndex: true,
        },
  )

  useEffect(() => {
    if (!post) return
    const id = 'spi-article-jsonld'
    document.getElementById(id)?.remove()
    const script = document.createElement('script')
    script.id = id
    script.type = 'application/ld+json'
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt || post.publishedAt,
      author: {
        '@type': 'Organization',
        name: 'Student Padel Ireland',
        url: SITE,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Student Padel Ireland',
        logo: {
          '@type': 'ImageObject',
          url: `${SITE}/images/student-padel-ireland-logo.png`,
        },
      },
      mainEntityOfPage: `${SITE}/blog/${post.slug}`,
      image: `${SITE}/images/student-padel-ireland-og.jpg`,
      keywords: post.tags.join(', '),
      inLanguage: 'en-IE',
    })
    document.head.appendChild(script)
    return () => {
      document.getElementById(id)?.remove()
    }
  }, [post])

  if (!post) {
    return <Navigate to="/blog" replace />
  }

  return (
    <div className="app-shell blog-shell">
      <main className="page blog-page">
        <article className="blog-article">
          <p className="eyebrow">
            <Link to={backTo}>← Student Padel Ireland</Link>
          </p>
          <h1 className="page-title">{post.title}</h1>
          <div className="blog-meta">
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          </div>
          <div className="blog-body">
            {post.body.map((block, i) => (
              <Block key={`${block.type}-${i}`} block={block} />
            ))}
          </div>
        </article>

        {related.length > 0 && (
          <aside className="blog-related">
            <p className="blog-related-label">More</p>
            <ul className="blog-related-list">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link to={`/blog/${r.slug}`}>{r.title}</Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>
    </div>
  )
}
