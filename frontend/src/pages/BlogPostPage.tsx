import { useEffect } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { usePageSeo } from '../hooks/usePageSeo'
import { getPostBySlug, getRelatedPosts, type BlogBlock } from '../data/blogPosts'
import './Blog.css'
import './Legal.css'

const SITE = 'https://studentpadel.ie'

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
  return (
    <div className="blog-cta">
      <p>{block.text}</p>
      <Link to={block.to} className="btn btn-primary">
        {block.label}
      </Link>
    </div>
  )
}

export default function BlogPostPage() {
  const { slug = '' } = useParams()
  const post = getPostBySlug(slug)
  const related = post ? getRelatedPosts(post.slug) : []

  usePageSeo(
    post
      ? {
          title: post.title,
          description: post.description,
          path: `/blog/${post.slug}`,
          type: 'article',
          publishedTime: post.publishedAt,
          modifiedTime: post.updatedAt || post.publishedAt,
          image: 'https://studentpadel.ie/images/student-padel-ireland-og.jpg',
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
    <div className="app-shell">
      <NavBar />
      <main className="page blog-page">
        <article className="blog-article">
          <p className="eyebrow">
            <Link to="/blog">← Blog</Link>
          </p>
          <h1 className="page-title">{post.title}</h1>
          <div className="blog-meta">
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
            <span>{post.readingMinutes} min read</span>
            <span>Student Padel Ireland</span>
          </div>
          <div className="blog-body">
            {post.body.map((block, i) => (
              <Block key={`${block.type}-${i}`} block={block} />
            ))}
          </div>
          <div className="blog-tags" style={{ marginTop: '1.5rem' }}>
            {post.tags.map((tag) => (
              <span key={tag} className="blog-tag">
                {tag}
              </span>
            ))}
          </div>
        </article>

        {related.length > 0 && (
          <aside className="blog-related">
            <h2>Related guides</h2>
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
