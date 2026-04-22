import fs from 'fs'
import path from 'path'

export interface BlogPost {
  slug: string
  title: string
  description: string
  date: string
  tags: string[]
  author: string
  cover: string
  content: string
}

export interface BlogFrontmatter {
  title: string
  description: string
  date: string
  tags: string[]
  author: string
  cover: string
}

export function parseFrontmatter(content: string): { frontmatter: BlogFrontmatter; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) {
    return {
      frontmatter: {
        title: '',
        description: '',
        date: '',
        tags: [],
        author: '',
        cover: '',
      },
      body: content,
    }
  }

  const fmStr = fmMatch[1]
  const body = fmMatch[2]

  const frontmatter: BlogFrontmatter = {
    title: '',
    description: '',
    date: '',
    tags: [],
    author: '',
    cover: '',
  }

  const titleMatch = fmStr.match(/^title:\s*"?(.+?)"?\s*$/m)
  const descMatch = fmStr.match(/^description:\s*"?(.+?)"?\s*$/m)
  const dateMatch = fmStr.match(/^date:\s*"?(.+?)"?\s*$/m)
  const authorMatch = fmStr.match(/^author:\s*"?(.+?)"?\s*$/m)
  const coverMatch = fmStr.match(/^cover:\s*"?(.+?)"?\s*$/m)
  const tagsMatch = fmStr.match(/^tags:\s*\[(.+)\]\s*$/m)

  if (titleMatch) frontmatter.title = titleMatch[1]
  if (descMatch) frontmatter.description = descMatch[1]
  if (dateMatch) frontmatter.date = dateMatch[1]
  if (authorMatch) frontmatter.author = authorMatch[1]
  if (coverMatch) frontmatter.cover = coverMatch[1]
  if (tagsMatch) {
    frontmatter.tags = tagsMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
  }

  return { frontmatter, body }
}

export function getAllPosts(): BlogPost[] {
  const postsDir = path.join(process.cwd(), 'content/blog')

  if (!fs.existsSync(postsDir)) return []

  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith('.mdx'))

  return files
    .map((file) => {
      const slug = file.replace('.mdx', '')
      const content = fs.readFileSync(path.join(postsDir, file), 'utf-8')
      const { frontmatter, body } = parseFrontmatter(content)

      return {
        slug,
        ...frontmatter,
        content: body,
      }
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function getPostBySlug(slug: string): BlogPost | null {
  const filePath = path.join(process.cwd(), 'content/blog', `${slug}.mdx`)

  if (!fs.existsSync(filePath)) return null

  const content = fs.readFileSync(filePath, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(content)

  return {
    slug,
    ...frontmatter,
    content: body,
  }
}
